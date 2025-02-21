// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1IjoiZWliYXJvbGxlIiwiYSI6ImNtN2Q5YzNwajAwcjcyam9xcXBwZnFhMWYifQ.SHI9IMjb9E1fjiy4uHSZlQ';

// Global variables for data storage
let stations = [];
let trips = [];
let filteredTrips = [];
let filteredArrivals = new Map();
let filteredDepartures = new Map();
let filteredStations = [];
let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

// Performance optimization: pre-sorted time buckets
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

// Initialize the map
const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [-71.09415, 42.36027],
    zoom: 12,
    minZoom: 5,
    maxZoom: 18
});

// Function to get coordinates for SVG placement
function getCoords(station) {
    const point = new mapboxgl.LngLat(+station.lon, +station.lat);
    const { x, y } = map.project(point);
    return { cx: x, cy: y };
}

// Time filtering setup
let timeFilter = -1;
const timeSlider = document.getElementById('time-slider');
const selectedTime = document.getElementById('selected-time');
const anyTimeLabel = document.getElementById('any-time');

function formatTime(minutes) {
    const date = new Date(0, 0, 0, 0, minutes);
    return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function minutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes();
}

function updateTimeDisplay() {
    timeFilter = Number(timeSlider.value);
    
    if (timeFilter === -1) {
        selectedTime.textContent = '';
        anyTimeLabel.style.display = 'block';
    } else {
        selectedTime.textContent = formatTime(timeFilter);
        anyTimeLabel.style.display = 'none';
    }
}

function filterByMinute(tripsByMinute, minute) {
    // Normalize both to the [0, 1439] range
    let minMinute = (minute - 60 + 1440) % 1440;
    let maxMinute = (minute + 60) % 1440;

    if (minMinute > maxMinute) {
        let beforeMidnight = tripsByMinute.slice(minMinute);
        let afterMidnight = tripsByMinute.slice(0, maxMinute);
        return beforeMidnight.concat(afterMidnight).flat();
    } else {
        return tripsByMinute.slice(minMinute, maxMinute).flat();
    }
}

function filterTripsbyTime() {
    if (!trips || trips.length === 0) {
        console.warn('No trips data available for filtering');
        return;
    }

    console.log('Filtering trips. Current time filter:', timeFilter);

    if (timeFilter === -1) {
        // If no time filter, use all trips
        filteredDepartures = d3.rollup(trips, v => v.length, d => d.start_station_id);
        filteredArrivals = d3.rollup(trips, v => v.length, d => d.end_station_id);
    } else {
        // Use the bucketed approach for filtered time
        const relevantDepartures = filterByMinute(departuresByMinute, timeFilter);
        const relevantArrivals = filterByMinute(arrivalsByMinute, timeFilter);
        
        filteredDepartures = d3.rollup(relevantDepartures, v => v.length, d => d.start_station_id);
        filteredArrivals = d3.rollup(relevantArrivals, v => v.length, d => d.end_station_id);
    }

    // Update filtered stations with new traffic data
    filteredStations = stations.map(station => {
        const filteredStation = { ...station };
        const id = filteredStation.short_name;
        
        filteredStation.arrivals = filteredArrivals.get(id) ?? 0;
        filteredStation.departures = filteredDepartures.get(id) ?? 0;
        filteredStation.totalTraffic = filteredStation.arrivals + filteredStation.departures;
        
        return filteredStation;
    });

    // Update visualization
    updateVisualization();
}

function updateVisualization() {
    const radiusScale = d3.scaleSqrt()
        .domain([0, d3.max(filteredStations, d => d.totalTraffic)])
        .range(timeFilter === -1 ? [0, 25] : [3, 50]);

    // Update circle sizes
    const svg = d3.select('#map').select('svg');
    svg.selectAll('circle')
        .data(filteredStations)
        .transition()
        .duration(500)
        .attr('r', d => radiusScale(d.totalTraffic))
        .style("--departure-ratio", d => stationFlow(d.departures / d.totalTraffic))
        .each(function(d) {
            d3.select(this).select('title')
                .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
        });
}

// Event listeners
timeSlider.addEventListener('input', () => {
    updateTimeDisplay();
    filterTripsbyTime();
});

map.on('load', () => {
    const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
    const csvurl = 'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';

    // Create SVG layer for the map
    const mapContainer = d3.select('#map');
    if (!mapContainer.select('svg').size()) {
        mapContainer.append('svg')
            .style('position', 'absolute')
            .style('top', 0)
            .style('left', 0)
            .style('pointer-events', 'none')
            .attr('width', '100%')
            .attr('height', '100%');
    }
    
    const svg = mapContainer.select('svg');

    // Load station data
    Promise.all([
        d3.json(jsonurl),
        d3.csv(csvurl)
    ]).then(([jsonData, tripData]) => {
        console.log('Loaded JSON Data:', jsonData);
        console.log('Loaded Trips:', tripData);

        // Process stations data
        stations = jsonData.data.stations;

        // Process trips data with time bucketing
        trips = tripData.map(trip => {
            const processedTrip = {
                ...trip,
                started_at: new Date(trip.started_at),
                ended_at: new Date(trip.ended_at)
            };
            
            // Add trips to time buckets
            const startedMinutes = minutesSinceMidnight(processedTrip.started_at);
            const endedMinutes = minutesSinceMidnight(processedTrip.ended_at);
            
            departuresByMinute[startedMinutes].push(processedTrip);
            arrivalsByMinute[endedMinutes].push(processedTrip);
            
            return processedTrip;
        });

        console.log('Processed trips count:', trips.length);

        // Initialize filtered data
        filterTripsbyTime();

        // Create initial visualization
        const circles = svg.selectAll('circle')
            .data(filteredStations)
            .enter()
            .append('circle')
            .attr('fill', 'steelblue')
            .attr('stroke', 'white') 
            .attr('stroke-width', 1)
            .attr('opacity', 0.8)
            .each(function(d) {
                d3.select(this)
                    .append('title')
                    .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
            })
            .style("--departure-ratio", d => stationFlow(d.departures / d.totalTraffic));

        // Update circle positions on map events
        function updatePositions() {
            circles
                .attr('cx', d => getCoords(d).cx)
                .attr('cy', d => getCoords(d).cy);
        }

        updatePositions();
        map.on('move', updatePositions);
        map.on('zoom', updatePositions);
        map.on('resize', updatePositions);
        map.on('moveend', updatePositions);
    }).catch(error => console.error('Error loading data:', error));

    // Add Boston and Cambridge bike lanes
    map.addSource('boston_route', {
        type: 'geojson',
        data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson?...'
    });

    map.addSource('cambridge_route', {
        type: 'geojson',
        data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'
    });

    map.addLayer({
        id: 'bike-lanes-boston',
        type: 'line',
        source: 'boston_route',
        paint: {
            'line-color': '#32D400',
            'line-width': 5,
            'line-opacity': 0.6
        }
    });

    map.addLayer({
        id: 'bike-lanes-cambridge',
        type: 'line',
        source: 'cambridge_route',
        paint: {
            'line-color': '#32D400',
            'line-width': 5,
            'line-opacity': 0.6
        }
    });
});