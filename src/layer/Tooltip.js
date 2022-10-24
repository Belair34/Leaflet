import {DivOverlay} from './DivOverlay';
import {Point, toPoint} from '../geometry/Point';
import {Map} from '../map/Map';
import {Layer} from './Layer';
import * as DomUtil from '../dom/DomUtil';
import * as DomEvent from '../dom/DomEvent';
import * as Util from '../core/Util';
import {FeatureGroup} from './FeatureGroup';

/*
 * @class Tooltip
 * @inherits DivOverlay
 * @aka L.Tooltip
 * Used to display small texts on top of map layers.
 *
 * @example
 * If you want to just bind a tooltip to marker:
 *
 * ```js
 * marker.bindTooltip("my tooltip text").openTooltip();
 * ```
 * Path overlays like polylines also have a `bindTooltip` method.
 *
 * A tooltip can be also standalone:
 *
 * ```js
 * var tooltip = L.tooltip()
 * 	.setLatLng(latlng)
 * 	.setContent('Hello world!<br />This is a nice tooltip.')
 * 	.addTo(map);
 * ```
 * or
 * ```js
 * var tooltip = L.tooltip(latlng, {content: 'Hello world!<br />This is a nice tooltip.'})
 * 	.addTo(map);
 * ```
 *
 *
 * Note about tooltip offset. Leaflet takes two options in consideration
 * for computing tooltip offsetting:
 * - the `offset` Tooltip option: it defaults to [0, 0], and it's specific to one tooltip.
 *   Add a positive x offset to move the tooltip to the right, and a positive y offset to
 *   move it to the bottom. Negatives will move to the left and top.
 * - the `tooltipAnchor` Icon option: this will only be considered for Marker. You
 *   should adapt this value if you use a custom icon.
 */


// @namespace Tooltip
export const Tooltip = DivOverlay.extend({

	// @section
	// @aka Tooltip options
	options: {
		// @option pane: String = 'tooltipPane'
		// `Map pane` where the tooltip will be added.
		pane: 'tooltipPane',

		// @option offset: Point = Point(0, 0)
		// Optional offset of the tooltip position.
		offset: [0, 0],

		// @option direction: String = 'auto'
		// Direction where to open the tooltip. Possible values are: `right`, `left`,
		// `top`, `bottom`, `center`, `auto`.
		// `auto` will dynamically switch between `right` and `left` according to the tooltip
		// position on the map.
		direction: 'auto',

		// @option permanent: Boolean = false
		// Whether to open the tooltip permanently or only on mouseover.
		permanent: false,

		// @option sticky: Boolean = false
		// If true, the tooltip will follow the mouse instead of being fixed at the feature center.
		sticky: false,

		// @option opacity: Number = 0.9
		// Tooltip container opacity.
		opacity: 0.9,

		// @option autoPan: Boolean = true
		// Set it to `false` if you don't want the map to do panning animation
		// to fit the opened popup.
		autoPan: false,

		// @option autoPanPaddingTopLeft: Point = null
		// The margin between the popup and the top left corner of the map
		// view after autopanning was performed.
		autoPanPaddingTopLeft: null,

		// @option autoPanPaddingBottomRight: Point = null
		// The margin between the popup and the bottom right corner of the map
		// view after autopanning was performed.
		autoPanPaddingBottomRight: null,

		// @option autoPanPadding: Point = Point(5, 5)
		// Equivalent of setting both top left and bottom right autopan padding to the same value.
		autoPanPadding: [0, 0],
	},

	onAdd(map) {
		// Used to make corrections to tooltip position based on CSS padding
		this.tooltipPadding = 6;

		DivOverlay.prototype.onAdd.call(this, map);
		this.setOpacity(this.options.opacity);

		// @namespace Map
		// @section Tooltip events
		// @event tooltipopen: TooltipEvent
		// Fired when a tooltip is opened in the map.
		map.fire('tooltipopen', {tooltip: this});

		if (this._source) {
			this.addEventParent(this._source);

			// @namespace Layer
			// @section Tooltip events
			// @event tooltipopen: TooltipEvent
			// Fired when a tooltip bound to this layer is opened.
			this._source.fire('tooltipopen', {tooltip: this}, true);
		}
	},

	onRemove(map) {
		DivOverlay.prototype.onRemove.call(this, map);

		// @namespace Map
		// @section Tooltip events
		// @event tooltipclose: TooltipEvent
		// Fired when a tooltip in the map is closed.
		map.fire('tooltipclose', {tooltip: this});

		if (this._source) {
			this.removeEventParent(this._source);

			// @namespace Layer
			// @section Tooltip events
			// @event tooltipclose: TooltipEvent
			// Fired when a tooltip bound to this layer is closed.
			this._source.fire('tooltipclose', {tooltip: this}, true);
		}
	},

	getEvents() {
		const events = DivOverlay.prototype.getEvents.call(this);

		if (!this.options.permanent) {
			events.preclick = this.close;
		}

		return events;
	},

	_initLayout() {
		const prefix = 'leaflet-tooltip',
		    className = `${prefix} ${this.options.className || ''} leaflet-zoom-${this._zoomAnimated ? 'animated' : 'hide'}`;

		this._contentNode = this._container = DomUtil.create('div', className);

		this._container.setAttribute('role', 'tooltip');
		this._container.setAttribute('id', `leaflet-tooltip-${Util.stamp(this)}`);
	},

	_updateLayout() {
		const container = this._contentNode,
		    style = container.style;

		style.width = '';
		style.whiteSpace = 'nowrap';

		let width = container.offsetWidth;
		width = Math.min(width, this.options.maxWidth);
		width = Math.max(width, this.options.minWidth);

		style.width = `${width + 1}px`;
		style.whiteSpace = '';

		style.height = '';

		const height = container.offsetHeight,
		    maxHeight = this.options.maxHeight,
		    scrolledClass = 'leaflet-popup-scrolled';

		if (maxHeight && height > maxHeight) {
			style.height = `${maxHeight}px`;
			DomUtil.addClass(container, scrolledClass);
		} else {
			DomUtil.removeClass(container, scrolledClass);
		}

		this._containerWidth = this._container.offsetWidth;
	},

	_adjustPan() {
		if (!this.options.autoPan) { console.log('fak'); return; }
		if (this._map._panAnim) { this._map._panAnim.stop(); }

		// We can endlessly recurse if keepInView is set and the view resets.
		// Let's guard against that by exiting early if we're responding to our own autopan.
		if (this._autopanning) {
			this._autopanning = false;
			return;
		}

		const map = this._map,
		    marginBottom = parseInt(DomUtil.getStyle(this._container, 'marginBottom'), 10) || 0,
		    containerHeight = this._container.offsetHeight + marginBottom,
		    containerWidth = this._containerWidth,
		    layerPos = new Point(this._containerLeft, -containerHeight - this._containerBottom);

		layerPos._add(DomUtil.getPosition(this._container));

		const containerPos = map.layerPointToContainerPoint(layerPos),
		    padding = toPoint(this.options.autoPanPadding),
		    paddingTL = toPoint(this.options.autoPanPaddingTopLeft || padding),
		    paddingBR = toPoint(this.options.autoPanPaddingBottomRight || padding),
		    size = map.getSize();
		let dx = 0,
		dy = 0;

		console.log(paddingBR);
		console.log(paddingTL);
		if (containerPos.x + containerWidth + paddingBR.x > size.x) { // right
			dx = containerPos.x + containerWidth - size.x + paddingBR.x + this.tooltipPadding;
		}
		if (containerPos.x - dx - paddingTL.x < 0) { // left
			dx = containerPos.x - paddingTL.x - this.tooltipPadding;
		}
		if (containerPos.y + containerHeight + paddingBR.y > size.y) { // bottom
			dy = containerPos.y + containerHeight - size.y + paddingBR.y;
		}
		if (containerPos.y - dy - paddingTL.y < 0) { // top
			dy = containerPos.y - paddingTL.y;
		}

		// @namespace Map
		// @section Popup events
		// @event autopanstart: Event
		// Fired when the map starts autopanning when opening a popup.
		if (dx || dy) {
			// Track that we're autopanning, as this function will be re-ran on moveend
			if (this.options.keepInView) {
				this._autopanning = true;
			}

			map
			    .fire('autopanstart')
			    .panBy([dx, dy]);
		}
	},

	_setPosition(pos) {
		let subX, subY, direction = this.options.direction;
		const map = this._map,
		      container = this._container,
		      centerPoint = map.latLngToContainerPoint(map.getCenter()),
		      tooltipPoint = map.layerPointToContainerPoint(pos),
		      tooltipWidth = container.offsetWidth,
		      tooltipHeight = container.offsetHeight,
		      anchor = this._getAnchor();

		if (direction === 'top') {
			subX = 0;
			subY = 0 + this.tooltipPadding;
		} else if (direction === 'bottom') {
			subX = 0;
			subY = -tooltipHeight - this.tooltipPadding;
		} else if (direction === 'center') {
			subX = 0;
			subY = -tooltipHeight / 2;
		} else if (direction === 'right') {
			subX = -tooltipWidth / 2;
			subY = -tooltipHeight / 2;
		} else if (direction === 'left') {
			subX = tooltipWidth / 2;
			subY = -tooltipHeight / 2;
		} else if (tooltipPoint.x < centerPoint.x) {
			direction = 'right';
			subX = -tooltipWidth / 2;
			subY = -tooltipHeight / 2;
		} else {
			direction = 'left';
			subX = tooltipWidth / 2 + anchor.x * 2;
			subY = -tooltipHeight / 2;
		}

		pos = pos.subtract(toPoint(subX, subY, true)).add(anchor);

		DomUtil.removeClass(container, 'leaflet-tooltip-right');
		DomUtil.removeClass(container, 'leaflet-tooltip-left');
		DomUtil.removeClass(container, 'leaflet-tooltip-top');
		DomUtil.removeClass(container, 'leaflet-tooltip-bottom');
		DomUtil.addClass(container, `leaflet-tooltip-${direction}`);
		DomUtil.setPosition(container, pos);
	},

	_updatePosition() {
		const pos = this._map.latLngToLayerPoint(this._latlng),
		offset = toPoint(this.options.offset);

		const bottom = this._containerBottom = -offset.y;
		const left = this._containerLeft = -Math.round(this._containerWidth / 2) + offset.x;

		this._container.style.bottom = `${bottom}px`;
		this._container.style.left = `${left}px`;
		this._setPosition(pos);
	},

	setOpacity(opacity) {
		this.options.opacity = opacity;

		if (this._container) {
			DomUtil.setOpacity(this._container, opacity);
		}
	},

	_animateZoom(e) {
		const pos = this._map._latLngToNewLayerPoint(this._latlng, e.zoom, e.center);
		this._setPosition(pos);
	},

	_getAnchor() {
		// Where should we anchor the tooltip on the source layer?
		return toPoint(this._source && this._source._getTooltipAnchor && !this.options.sticky ? this._source._getTooltipAnchor() : [0, 0]);
	}

});

// @namespace Tooltip
// @factory L.tooltip(options?: Tooltip options, source?: Layer)
// Instantiates a `Tooltip` object given an optional `options` object that describes its appearance and location and an optional `source` object that is used to tag the tooltip with a reference to the Layer to which it refers.
// @alternative
// @factory L.tooltip(latlng: LatLng, options?: Tooltip options)
// Instantiates a `Tooltip` object given `latlng` where the tooltip will open and an optional `options` object that describes its appearance and location.
export const tooltip = function (options, source) {
	return new Tooltip(options, source);
};

// @namespace Map
// @section Methods for Layers and Controls
Map.include({

	// @method openTooltip(tooltip: Tooltip): this
	// Opens the specified tooltip.
	// @alternative
	// @method openTooltip(content: String|HTMLElement, latlng: LatLng, options?: Tooltip options): this
	// Creates a tooltip with the specified content and options and open it.
	openTooltip(tooltip, latlng, options) {
		this._initOverlay(Tooltip, tooltip, latlng, options)
		  .openOn(this);

		return this;
	},

	// @method closeTooltip(tooltip: Tooltip): this
	// Closes the tooltip given as parameter.
	closeTooltip(tooltip) {
		tooltip.close();
		return this;
	}

});

/*
 * @namespace Layer
 * @section Tooltip methods example
 *
 * All layers share a set of methods convenient for binding tooltips to it.
 *
 * ```js
 * var layer = L.Polygon(latlngs).bindTooltip('Hi There!').addTo(map);
 * layer.openTooltip();
 * layer.closeTooltip();
 * ```
 */

// @section Tooltip methods
Layer.include({

	// @method bindTooltip(content: String|HTMLElement|Function|Tooltip, options?: Tooltip options): this
	// Binds a tooltip to the layer with the passed `content` and sets up the
	// necessary event listeners. If a `Function` is passed it will receive
	// the layer as the first argument and should return a `String` or `HTMLElement`.
	bindTooltip(content, options) {

		if (this._tooltip && this.isTooltipOpen()) {
			this.unbindTooltip();
		}

		this._tooltip = this._initOverlay(Tooltip, this._tooltip, content, options);
		this._initTooltipInteractions();

		if (this._tooltip.options.permanent && this._map && this._map.hasLayer(this)) {
			this.openTooltip();
		}

		return this;
	},

	// @method unbindTooltip(): this
	// Removes the tooltip previously bound with `bindTooltip`.
	unbindTooltip() {
		if (this._tooltip) {
			this._initTooltipInteractions(true);
			this.closeTooltip();
			this._tooltip = null;
		}
		return this;
	},

	_initTooltipInteractions(remove) {
		if (!remove && this._tooltipHandlersAdded) { return; }
		const onOff = remove ? 'off' : 'on',
		    events = {
			remove: this.closeTooltip,
			move: this._moveTooltip
		  };
		if (!this._tooltip.options.permanent) {
			events.mouseover = this._openTooltip;
			events.mouseout = this.closeTooltip;
			events.click = this._openTooltip;
			if (this._map) {
				this._addFocusListeners();
			} else {
				events.add = this._addFocusListeners;
			}
		} else {
			events.add = this._openTooltip;
		}
		if (this._tooltip.options.sticky) {
			events.mousemove = this._moveTooltip;
		}
		this[onOff](events);
		this._tooltipHandlersAdded = !remove;
	},

	// @method openTooltip(latlng?: LatLng): this
	// Opens the bound tooltip at the specified `latlng` or at the default tooltip anchor if no `latlng` is passed.
	openTooltip(latlng) {
		if (this._tooltip) {
			if (!(this instanceof FeatureGroup)) {
				this._tooltip._source = this;
			}
			if (this._tooltip._prepareOpen(latlng)) {
				// open the tooltip on the map
				this._tooltip.openOn(this._map);

				if (this.getElement) {
					this._setAriaDescribedByOnLayer(this);
				} else if (this.eachLayer) {
					this.eachLayer(this._setAriaDescribedByOnLayer, this);
				}
			}
		}
		return this;
	},

	// @method closeTooltip(): this
	// Closes the tooltip bound to this layer if it is open.
	closeTooltip() {
		if (this._tooltip) {
			return this._tooltip.close();
		}
	},

	// @method toggleTooltip(): this
	// Opens or closes the tooltip bound to this layer depending on its current state.
	toggleTooltip() {
		if (this._tooltip) {
			this._tooltip.toggle(this);
		}
		return this;
	},

	// @method isTooltipOpen(): boolean
	// Returns `true` if the tooltip bound to this layer is currently open.
	isTooltipOpen() {
		return this._tooltip.isOpen();
	},

	// @method setTooltipContent(content: String|HTMLElement|Tooltip): this
	// Sets the content of the tooltip bound to this layer.
	setTooltipContent(content) {
		if (this._tooltip) {
			this._tooltip.setContent(content);
		}
		return this;
	},

	// @method getTooltip(): Tooltip
	// Returns the tooltip bound to this layer.
	getTooltip() {
		return this._tooltip;
	},

	_addFocusListeners() {
		if (this.getElement) {
			this._addFocusListenersOnLayer(this);
		} else if (this.eachLayer) {
			this.eachLayer(this._addFocusListenersOnLayer, this);
		}
	},

	_addFocusListenersOnLayer(layer) {
		const el = layer.getElement();
		if (el) {
			DomEvent.on(el, 'focus', function () {
				this._tooltip._source = layer;
				this.openTooltip();
			}, this);
			DomEvent.on(el, 'blur', this.closeTooltip, this);
		}
	},

	_setAriaDescribedByOnLayer(layer) {
		const el = layer.getElement();
		if (el) {
			el.setAttribute('aria-describedby', this._tooltip._container.id);
		}
	},


	_openTooltip(e) {
		if (!this._tooltip || !this._map || (this._map.dragging && this._map.dragging.moving())) {
			return;
		}
		this._tooltip._source = e.layer || e.target;

		this.openTooltip(this._tooltip.options.sticky ? e.latlng : undefined);
	},

	_moveTooltip(e) {
		let latlng = e.latlng, containerPoint, layerPoint;
		if (this._tooltip.options.sticky && e.originalEvent) {
			containerPoint = this._map.mouseEventToContainerPoint(e.originalEvent);
			layerPoint = this._map.containerPointToLayerPoint(containerPoint);
			latlng = this._map.layerPointToLatLng(layerPoint);
		}
		this._tooltip.setLatLng(latlng);
	}
});
